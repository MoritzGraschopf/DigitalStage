'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {usePathname, useRouter} from 'next/navigation';

type User = {
    id: number;
    name: string;
    email: string;
};

type AuthContextType = {
    token: string | null;
    user: User | null;
    fetchUser: () => Promise<void>;
    login: (email: string, password: string, redirect: string) => Promise<void>;
    logout: () => void;
    register: (email: string, name: string, password: string, redirect: string) => Promise<void>;
    fetchWithAuth: <T>(url: string, options?: RequestInit) => Promise<T>;
    isAuthenticated: boolean;
    loading: boolean;
    userLoading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [token, setToken] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [userLoading, setUserLoading] = useState(false);
    const router = useRouter();
    const pathname = usePathname()

    useEffect(() => {
        const savedToken = localStorage.getItem('token');
        if (savedToken) {
            setToken(savedToken);
        }
        setLoading(false);
    }, []);

    const fetchWithAuth = useCallback(async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
        if (!token) {
            return Promise.reject(new Error('No token found. Please log in.'));
        }

        const headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        return fetch(url, {
            ...options,
            headers,
        }).then((response) => {
            if (!response.ok) {
                return Promise.reject(new Error(`Request failed with status ${response.status}`));
            }
            return response.json();
        });
    }, [token]);

    const login = async (email: string, password: string, redirect: string) => {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) throw new Error('Login failed');

        const data = await res.json();
        localStorage.setItem('token', data.token);
        setToken(data.token);
        router.push(redirect);
    };

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
        router.push('/auth?redirect=' + pathname);
    }, [router, pathname]);

    const fetchUser = useCallback(async () => {
        if (!token) return;
        setUserLoading(true);
        try {
            const data = await fetchWithAuth<User>('/api/me');
            setUser(data);
        } catch (err) {
            console.error(err);
            setUser(null);
            logout();
        } finally {
            setUserLoading(false);
        }
    }, [token, fetchWithAuth, logout]);

    useEffect(() => {
        if (token) {
            fetchUser().then();
        }
    }, [token, fetchUser]);

    const register = async (email: string, name: string, password: string, redirect: string) => {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, password }),
        });

        if (res.status === 409) {
            throw new Error('User already exists. Please use a different email.');
        }


        if (!res.ok) throw new Error('Registration failed');

        const data = await res.json();
        localStorage.setItem('token', data.token);
        setToken(data.token);
        router.push(redirect);
    };

    return (
        <AuthContext.Provider
            value={{
                token,
                user,
                fetchUser,
                login,
                logout,
                register,
                fetchWithAuth,
                isAuthenticated: !!token,
                loading,
                userLoading,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};