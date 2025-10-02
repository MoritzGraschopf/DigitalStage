"use client"

import React, {JSX} from "react";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useWS } from "@/context/WebSocketContext";
import {useAuth} from "@/context/AuthContext";
import {Button} from "@/components/ui/button";
import {Check, Copy, X, Clock} from "lucide-react";

// --- UI Maps ---
const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    connecting: { label: "Verbindet...", variant: "secondary" },
    open: { label: "Verbunden", variant: "default" },
    closed: { label: "Geschlossen", variant: "outline" },
    error: { label: "Fehler", variant: "destructive" },
};
const copiedMap: Record<"default" | "copied" | "error", () => JSX.Element> = {
    default: () => <Copy/>,
    copied: () => <Check/>,
    error: () => <X/>,
};

// --- JWT Utils ---
type JwtPayload = { exp?: number; iat?: number; [k: string]: unknown };

function base64UrlDecode(input: string): string {
    // Replace URL-safe chars and pad
    let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    // Decode
    if (typeof window !== "undefined" && "atob" in window) {
        // Handle unicode safely
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }
    // Fallback (SSR — sollte hier nicht passieren)
    return Buffer.from(b64, "base64").toString("utf-8");
}

function decodeJwt(token: string | null | undefined): JwtPayload | null {
    try {
        if (!token) return null;
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const payloadJson = base64UrlDecode(parts[1]);
        return JSON.parse(payloadJson);
    } catch {
        return null;
    }
}

function formatDuration(ms: number): string {
    if (ms < 0) return "0s";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

const DeveloperPage: React.FC = () => {
    const { token } = useAuth();
    const { status } = useWS();
    const state = statusMap[status] ?? { label: status, variant: "outline" };

    const [copiedState, setCopiedState] = React.useState<"default" | "copied" | "error">("default");
    const CopiedIcon = copiedMap[copiedState];

    // Decode once
    const payload = React.useMemo(() => decodeJwt(token), [token]);
    const expMs = React.useMemo(() => (payload?.exp ? payload.exp * 1000 : null), [payload?.exp]);

    // Live countdown
    const [now, setNow] = React.useState<number>(Date.now());
    React.useEffect(() => {
        if (!expMs) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [expMs]);
    const remainingMs = expMs ? expMs - now : null;
    const isExpired = expMs ? remainingMs! <= 0 : false;

    // Optional: Prozentanzeige (wenn iat vorhanden)
    const percentLeft = React.useMemo(() => {
        if (!payload?.iat || !payload?.exp) return null;
        const total = (payload.exp - payload.iat) * 1000;
        const left = Math.max(0, (payload.exp * 1000) - now);
        return Math.max(0, Math.min(100, Math.round((left / total) * 100)));
    }, [payload?.iat, payload?.exp, now]);

    const copyToken = () => {
        if (token) {
            navigator.clipboard.writeText(token).then(
                () => {
                    setCopiedState("copied");
                    setTimeout(() => setCopiedState("default"), 2000);
                },
                () => {
                    setCopiedState("error");
                    setTimeout(() => setCopiedState("default"), 2000);
                }
            );
        } else {
            setCopiedState("error");
            setTimeout(() => setCopiedState("default"), 2000);
        }
    };

    // Badge-Farbe für Gültigkeit
    const validityBadge =
        expMs == null ? (
            <Badge variant="outline">Ohne Ablauf (<code>exp</code> fehlt)</Badge>
        ) : isExpired ? (
            <Badge variant="destructive">Abgelaufen</Badge>
        ) : remainingMs! < 60_000 ? (
            <Badge variant="destructive">Läuft gleich ab</Badge>
        ) : remainingMs! < 5 * 60_000 ? (
            <Badge variant="secondary">Bald ablaufend</Badge>
        ) : (
            <Badge variant="default">Gültig</Badge>
        );

    return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Entwickler</h1>
            <Separator className="my-2" />

            {/* WS Status */}
            <div className="my-4 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">WebSocket Status:</span>
                <Badge variant={state.variant}>{state.label}</Badge>
            </div>

            <Separator className="my-2" />

            {/* Token Copy */}
            <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Token:</span>
                <Button size="icon" variant="outline" onClick={copyToken} aria-label="Copy token">
                    <CopiedIcon/>
                </Button>
            </div>

            {/* Token Validity */}
            <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" /> JWT Gültigkeit
          </span>
                    {validityBadge}
                </div>

                {expMs != null && (
                    <>
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Läuft ab am:</span>
                            <span>{new Date(expMs).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Restzeit:</span>
                            <span>{isExpired ? "0s" : formatDuration(remainingMs!)}</span>
                        </div>

                        {percentLeft != null && (
                            <div className="mt-2">
                                {/* simple progress ohne extra Komponente */}
                                <div className="h-2 w-full rounded bg-muted overflow-hidden">
                                    <div
                                        className="h-2 bg-primary"
                                        style={{ width: `${percentLeft}%` }}
                                        aria-hidden
                                    />
                                </div>
                                <div className="mt-1 text-right text-xs text-muted-foreground">{percentLeft}% übrig</div>
                            </div>
                        )}
                    </>
                )}

                {token == null && (
                    <div className="text-sm text-muted-foreground">
                        Kein Token verfügbar (nicht eingeloggt?).
                    </div>
                )}

                {token && expMs == null && (
                    <div className="text-sm text-muted-foreground">
                        Dein Token enthält keine <code>exp</code>-Claim. Es könnte serverseitig anders begrenzt sein
                        (z. B. durch Session/Blacklist/Rotation).
                    </div>
                )}
            </div>
        </div>
    );
};

export default DeveloperPage;
