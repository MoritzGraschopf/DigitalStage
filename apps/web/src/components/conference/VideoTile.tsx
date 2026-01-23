"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VideoTileProps = {
    stream: MediaStream | null;
    title: string;
    mutedByDefault?: boolean;
    className?: string;
    mirror?: boolean;
    isLocal?: boolean;
    noBorder?: boolean;
};

export function VideoTile({
    stream,
    title,
    mutedByDefault = false,
    className = "",
    mirror = false,
    isLocal = false,
    noBorder = false,
}: VideoTileProps) {
    const ref = useRef<HTMLVideoElement | null>(null);
    const [muted, setMuted] = useState<boolean>(mutedByDefault);
    const [needsUserAction, setNeedsUserAction] = useState(false);
    const isPlayingRef = useRef(false);
    const currentStreamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        setMuted(mutedByDefault);
    }, [mutedByDefault]);

    const tryPlay = useCallback(() => {
        const el = ref.current;
        if (!el || !stream) return;
        const playPromise = el.play();
        if (playPromise) {
            playPromise
                .then(() => {
                    setTimeout(() => {
                        if (el.paused || el.readyState === 0) {
                            console.warn("Video paused or not ready after play()", title);
                            setNeedsUserAction(true);
                        } else {
                            setNeedsUserAction(false);
                        }
                    }, 500);
                })
                .catch((err: DOMException) => {
                    console.warn("autoplay blocked", title, err.name, err.message);
                    setNeedsUserAction(true);
                });
        } else {
            setTimeout(() => {
                if (el.paused || el.readyState === 0) {
                    setNeedsUserAction(true);
                }
            }, 500);
        }
    }, [title, stream]);

    const handleUserPlay = useCallback(() => {
        const el = ref.current;
        if (!el || isPlayingRef.current)
            return;

        if(isLocal){
            el.muted = true;
            setNeedsUserAction(false);
            isPlayingRef.current = true;
            return;
        }
        
        isPlayingRef.current = true;
        setMuted(false);
        el.muted = false;
        
        const attemptPlay = () => {
            const playPromise = el.play();
            if (playPromise) {
                playPromise
                    .then(() => {
                        console.log("✅ Video started after user interaction", title);
                        setNeedsUserAction(false);
                        isPlayingRef.current = false;
                    })
                    .catch((err: DOMException) => {
                        if (err.name === "AbortError") {
                            console.warn("⚠️ Play interrupted, retrying...", title);
                            setTimeout(() => {
                                if (ref.current && !ref.current.paused) {
                                    setNeedsUserAction(false);
                                    isPlayingRef.current = false;
                                } else if (ref.current) {
                                    attemptPlay();
                                } else {
                                    isPlayingRef.current = false;
                                }
                            }, 100);
                        } else {
                            console.error("❌ Play failed even after user interaction", title, err);
                            setNeedsUserAction(true);
                            isPlayingRef.current = false;
                        }
                    });
            } else {
                isPlayingRef.current = false;
            }
        };
        
        attemptPlay();
    }, [title, isLocal]);

    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;

        if (currentStreamRef.current !== stream) {
            currentStreamRef.current = stream;
            el.srcObject = stream;
        }
        
        el.muted = muted; // autoplay-policy safe

        if (!isPlayingRef.current) {
            tryPlay();
        }

        if (!stream) return;

        const onMeta = (): void => {
            console.log(
                "🎬 loadedmetadata",
                title,
                "tracks:",
                stream.getTracks().map(t => t.kind)
            );

            tryPlay();
        };

        const onAddTrack = (ev: MediaStreamTrackEvent): void => {
            console.log("➕ track added", title, ev.track.kind);
            onMeta();
        };

        const onPlaying = (): void => {
            console.log("▶️ playing", title);
            setNeedsUserAction(false);
        };

        const onPause = (): void => {
            console.log("⏸️ paused", title);
            if (el.readyState > 0 && stream.getTracks().length > 0) {
                setNeedsUserAction(true);
            }
        };

        // Handler setzen
        stream.onaddtrack = onAddTrack;
        el.addEventListener("loadedmetadata", onMeta);
        el.addEventListener("playing", onPlaying);
        el.addEventListener("pause", onPause);

        if (el.readyState >= 1) onMeta();

        const checkTimeout = setTimeout(() => {
            if (el.paused && el.readyState > 0 && stream.getTracks().length > 0) {
                console.warn("Video still paused after setup", title);
                setNeedsUserAction(true);
            }
        }, 1000);

        return () => {
            clearTimeout(checkTimeout);
            stream.onaddtrack = null;
            el.removeEventListener("loadedmetadata", onMeta);
            el.removeEventListener("playing", onPlaying);
            el.removeEventListener("pause", onPause);
        };
    }, [stream, muted, tryPlay, title]);

    const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState !== "ended");
    const hasAudio = !!stream?.getAudioTracks().some((t) => t.readyState !== "ended");

    return (
        <div className={`relative rounded-xl overflow-hidden bg-gradient-to-br from-background to-muted/30 ${noBorder ? '' : 'border shadow-lg hover:shadow-xl'} transition-all duration-300 group ${className}`}>
            <div className="relative aspect-video bg-gradient-to-br from-muted/20 to-muted/10">
                <video
                    ref={ref}
                    autoPlay
                    playsInline
                    muted={isLocal ? true: muted}
                    className={`w-full h-full object-cover ${mirror ? "scale-x-[-1]" : ""}`}
                />
                {!hasVideo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/40 to-muted/20 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="text-3xl mb-2 opacity-50">📹</div>
                            <div className="text-sm text-muted-foreground">Kein Video</div>
                        </div>
                    </div>
                )}
                {needsUserAction && (
                    <button
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm text-white text-base font-medium flex items-center justify-center z-10 hover:bg-black/80 active:bg-black/90 transition-all cursor-pointer"
                        onClick={handleUserPlay}
                        type="button"
                    >
                        <div className="text-center">
                            <div className="text-4xl mb-3">▶️</div>
                            <div className="text-sm">Tippe zum Abspielen</div>
                        </div>
                    </button>
                )}
                
                {/* Audio Status Indicator */}
                {hasAudio && !muted && (
                    <div className="absolute top-3 right-3 bg-green-500/90 text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 backdrop-blur-sm shadow-lg">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                        <span className="font-medium">Audio</span>
                    </div>
                )}

                {/* Name and Controls Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs sm:text-sm font-semibold text-white truncate flex-1 min-w-0">{title}</span>
                        {hasAudio && (
                            <button
                                className="ml-2 sm:ml-3 p-1.5 sm:p-2 rounded-lg bg-black/40 hover:bg-black/60 text-white transition-all flex-shrink-0 backdrop-blur-sm hover:scale-110 active:scale-95"
                                onClick={() => setMuted(m => !m)}
                                title={muted ? "Ton an" : "Ton aus"}
                            >
                                {muted ? (
                                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                    </svg>
                                ) : (
                                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
