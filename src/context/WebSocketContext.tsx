// src/context/WebSocketContext.tsx
"use client"
import React, {createContext, useContext, useEffect, useMemo, useRef, useState} from "react"

type WSStatus = "connecting" | "open" | "closed" | "error"
type MessageHandler = (data: unknown) => void

type WSContextType = {
    status: WSStatus
    send: (msg: unknown) => void
    on: (type: string, fn: MessageHandler) => () => void // unsubscribe returns cleanup
}

const WSContext = createContext<WSContextType | null>(null)

export function WebSocketProvider({children}: {children: React.ReactNode}) {
    const [status, setStatus] = useState<WSStatus>("connecting")
    const wsRef = useRef<WebSocket | null>(null)
    const handlers = useRef<Map<string, Set<MessageHandler>>>(new Map())

    useEffect(() => {
        let retry = 0
        function connect() {
            const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!)
            wsRef.current = ws
            setStatus("connecting")

            ws.onopen = () => {
                setStatus("open")
                retry = 0
                // Optional: Identify client/session here if nötig
                // ws.send(JSON.stringify({type:"hello"}))
            }

            ws.onmessage = (evt) => {
                try {
                    const msg = JSON.parse(evt.data)
                    const set = handlers.current.get(msg.type)
                    if (set) set.forEach(fn => fn(msg))
                } catch {}
            }

            ws.onerror = () => setStatus("error")

            ws.onclose = () => {
                setStatus("closed")
                // Reconnect with backoff
                const delay = Math.min(1000 * 2 ** retry, 10000)
                retry++
                setTimeout(connect, delay)
            }
        }
        connect()
        return () => wsRef.current?.close()
    }, [])

    const api = useMemo<WSContextType>(() => ({
        status,
        send: (msg: unknown) => wsRef.current?.readyState === 1 && wsRef.current?.send(JSON.stringify(msg)),
        on: (type: string, fn: MessageHandler) => {
            if (!handlers.current.has(type)) handlers.current.set(type, new Set())
            handlers.current.get(type)!.add(fn)
            return () => handlers.current.get(type)?.delete(fn)
        }
    }), [status])

    return <WSContext.Provider value={api}>{children}</WSContext.Provider>
}

export function useWS() {
    const ctx = useContext(WSContext)
    if (!ctx) throw new Error("useWS must be used within WebSocketProvider")
    return ctx
}
