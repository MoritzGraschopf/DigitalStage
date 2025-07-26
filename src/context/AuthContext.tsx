'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type AuthContextType = {
    token: string | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    register: (email: string, name: string, password: string) => Promise<void>
    isAuthenticated: boolean;
    loading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const savedToken = localStorage.getItem('token');
        if (savedToken) {
            setToken(savedToken);
        }
        setLoading(false);
    }, []);

    const login = async (email: string, password: string) => {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) throw new Error('Login fehlgeschlagen');

        const data = await res.json();
        localStorage.setItem('token', data.token);
        setToken(data.token);
        router.push('/app');
    };

    const logout = () => {
        localStorage.removeItem('token');
        setToken(null);
        router.push('/auth');
    };

    const register = async (email: string, name: string, password: string) => {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, password }),
        });

        if (!res.ok) throw new Error('Registrierung fehlgeschlagen');

        const data = await res.json();
        localStorage.setItem('token', data.token);
        setToken(data.token);
        router.push('/app');
    };


    return (
        <AuthContext.Provider value={{ token, login, logout, register, isAuthenticated: !!token, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth muss innerhalb eines AuthProviders verwendet werden');
    return context;
};
