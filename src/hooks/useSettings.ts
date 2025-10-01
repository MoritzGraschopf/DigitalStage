// src/hooks/useSettings.ts
"use client";
import useSWR from "swr";
import { useAuth } from "@/context/AuthContext";

type UserSettings = {
    locale: string;
    timezone: string;
    autoplayHls: boolean;
    notifyChatToasts: boolean;
    notifyConfCreated: boolean;
    wsReconnect: boolean;
};

type SettingsResponse = { settings: UserSettings };

export function useSettings() {
    const { isAuthenticated, fetchWithAuth } = useAuth();

    const { data, error, isLoading, mutate } = useSWR<SettingsResponse>(
        isAuthenticated ? "/api/user/settings" : null,
        (url: string) => fetchWithAuth<SettingsResponse>(url)
    );

    // Optimistic Update + persist via PUT
    const update = async (patch: Partial<UserSettings>) => {
        const prev = data;
        await mutate(
            prev ? { settings: { ...prev.settings, ...patch } } : undefined,
            { revalidate: false }
        );
        try {
            const updated = await fetchWithAuth<SettingsResponse>("/api/user/settings", {
                method: "PUT",
                body: JSON.stringify(patch),
            });
            await mutate(updated, { revalidate: false });
        } catch (e) {
            await mutate(prev, { revalidate: false }); // rollback
            throw e;
        }
    };

    return {
        settings: data?.settings,
        isLoading,
        error,
        update,
    };
}
