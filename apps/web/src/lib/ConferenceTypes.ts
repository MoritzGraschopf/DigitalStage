import { Conference, User, UserConference } from "@prisma/client";

export type ConferenceWithParticipants = Conference & { 
    participants: Array<UserConference & { isPresenter?: boolean }> 
};

export type ExtendedRole = "ORGANIZER" | "PARTICIPANT" | "VIEWER" | "QUESTIONER";

export type UserLite = Pick<User, "id" | "firstName" | "lastName">;

export const mapStatus = (status: string): string =>
    ({ SCHEDULED: "Geplant", ACTIVE: "Aktiv", ENDED: "Beendet" } as const)[status] ?? "Unbekannt";
