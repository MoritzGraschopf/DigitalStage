//Proove if jwt is set

import jwt from 'jsonwebtoken';

export function verifyToken(token: string): {userId: number; email: string}{
    const secret = process.env.JWT_SECRET;
    if(!secret) throw new Error("JWT secret must be provided");
    return jwt.verify(token, secret) as {userId: number; email: string};
}