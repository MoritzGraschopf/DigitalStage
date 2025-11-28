"use client";

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

type WSStatus = "connecting" | "open" | "closed" | "error";
type MessageHandler = (data: unknown) => void;

type WSContextType = {
    status: WSStatus;
    send: (msg: unknown) => void;
    on: (type: string, fn: MessageHandler) => () => void;
    __addRaw__: (fn: (evt: MessageEvent) => void) => () => void;
    __readyState__: number;
};

const WSContext = createContext<WSContextType | null>(null);

const getWsUrl = () => {
    // 1) Bevorzugt gesetzte Env (z.B. ws://10.0.29.108:3001)
    const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
    if (fromEnv) return fromEnv;

    // 2) Sonst dynamisch vom aktuellen Host ableiten (gleiches Host/Schema)
    if (typeof window !== 'undefined') {
        const isSecure = window.location.protocol === 'https:';
        const scheme = isSecure ? 'wss' : 'ws';
        // Wenn dein WS-Server auf einem separaten Port läuft, hier anpassen:
        const port = window.location.port || (isSecure ? '443' : '80');
        return `${scheme}://${window.location.hostname}:${port}/ws`;
    }

    // 3) SSR-Fallback (wird vom Browser eh überschrieben)
    return 'ws://localhost:3001';
};

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = useState<WSStatus>("connecting");
    const wsRef = useRef<WebSocket | null>(null);
    const handlers = useRef<Map<string, Set<MessageHandler>>>(new Map());
    const rawHandlers = useRef<Set<(evt: MessageEvent) => void>>(new Set());
    const sendQueueRef = useRef<string[]>([]);

    const flushQueue = useCallback(() => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        const queue = sendQueueRef.current;
        while (queue.length > 0) {
            const next = queue.shift();
            if (next) socket.send(next);
        }
    }, []);

    useEffect(() => {
        let retry = 0;
        let closed = false;

        const connect = () => {
            if (closed) return;
            //const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
            const ws = new WebSocket(getWsUrl());
            wsRef.current = ws;
            setStatus("connecting");

            ws.onopen = () => {
                setStatus("open");
                retry = 0;
                flushQueue();
            };

            ws.onmessage = (evt) => {
                rawHandlers.current.forEach((fn) => fn(evt));
                try {
                    const msg = JSON.parse((evt as MessageEvent).data as string);
                    const set = handlers.current.get(msg?.type);
                    if (set) set.forEach((fn) => fn(msg));
                } catch {
                    /* ignore parse errors */
                }
            };

            ws.onerror = () => setStatus("error");

            ws.onclose = () => {
                setStatus("closed");
                const delay = Math.min(1000 * 2 ** retry, 10000);
                retry++;
                setTimeout(connect, delay);
            };
        };

        connect();

        return () => {
            closed = true;
            wsRef.current?.close();
        };
    }, [flushQueue]);

    const api = useMemo<WSContextType>(() => {
        const ready =
            wsRef.current?.readyState ??
            (status === "open" ? 1 : status === "connecting" ? 0 : 3);

        return {
            status,
            send: (msg: unknown) => {
                const s = wsRef.current;
                if (!s) return;
                const payload = typeof msg === "string" ? msg : JSON.stringify(msg);
                if (s.readyState === WebSocket.OPEN) {
                    s.send(payload);
                } else {
                    sendQueueRef.current.push(payload);
                }
            },
            on: (type: string, fn: MessageHandler) => {
                if (!handlers.current.has(type)) handlers.current.set(type, new Set());
                handlers.current.get(type)!.add(fn);
                return () => handlers.current.get(type)?.delete(fn);
            },
            __addRaw__: (fn: (evt: MessageEvent) => void) => {
                rawHandlers.current.add(fn);
                return () => rawHandlers.current.delete(fn);
            },
            __readyState__: ready,
        };
    }, [status]);

    return <WSContext.Provider value={api}>{children}</WSContext.Provider>;
}

export function useWS() {
    const ctx = useContext(WSContext);
    if (!ctx) throw new Error("useWS must be used within WebSocketProvider");
    return ctx;
}

export function useWebSocket() {
    const ctx = useWS();

    const offMapRef = useRef(new WeakMap<(ev: MessageEvent) => void, () => void>());

    const socket = useMemo(() => {
        return {
            send: (obj: unknown) => ctx.send(obj),
            addEventListener: (ev: "message", cb: (ev: MessageEvent) => void) => {
                if (ev !== "message") return;
                const off = ctx.__addRaw__(cb);
                offMapRef.current.set(cb, off);
            },
            removeEventListener: (ev: "message", cb: (ev: MessageEvent) => void) => {
                if (ev !== "message") return;
                const off = offMapRef.current.get(cb);
                if (off){
                    off();
                    offMapRef.current.delete(cb);
                }
            },
            readyState: ctx.__readyState__,
        };
    }, [ctx]);

    return { socket, status: ctx.status, send: ctx.send, on: ctx.on };
}
