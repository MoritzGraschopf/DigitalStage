"use client";

import React, {
    createContext,
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

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = useState<WSStatus>("connecting");
    const wsRef = useRef<WebSocket | null>(null);
    const handlers = useRef<Map<string, Set<MessageHandler>>>(new Map());
    const rawHandlers = useRef<Set<(evt: MessageEvent) => void>>(new Set());

    useEffect(() => {
        let retry = 0;
        let closed = false;

        const connect = () => {
            if (closed) return;
            const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
            wsRef.current = ws;
            setStatus("connecting");

            ws.onopen = () => {
                setStatus("open");
                retry = 0;
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
    }, []);

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
                if (s.readyState === 1) s.send(payload);
                else s.addEventListener("open", () => s.send(payload), { once: true });
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
