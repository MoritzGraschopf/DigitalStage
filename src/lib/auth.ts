//Proove if jwt is set

import jwt from 'jsonwebtoken';

export function verifyToken(token: string): {userId: string; email: string}{
    const secret = process.env.JWT_SECRET;
    if(!secret) throw new Error("JWT secret must be provided");
    return jwt.verify(token, secret) as {userId: string; email: string};
}

export function getUserIdFromAuthHeader(authHeader: string | null) {
    const token = authHeader?.split(' ')[1];
    if (!token) return null;
    const secret = process.env.JWT_SECRET!;
    const payload = jwt.verify(token, secret) as { userId: string };
    return payload.userId;
}