import type {NextApiRequest, NextApiResponse} from "next";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma'; //Pfad unbedingt noch anpassen!!!

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if(req.method !== 'POST'){
        return res.status(405).json({message: 'Method Not Allowed'});
    }

    const {email, password} = req.body;

    if(!email || !password){
        return res.status(400).json({message: 'Email and password are required'});
    }

    try{
        const user = await prisma.user.findUnique({where: {email}});

        if(!user){
            return res.status(401).json({message: 'User not found'});

            //Funktioniert erst wenn DB aktiv
            //const passwordMatch =  await bcrypt.compare(password, user.passwordHash);


        }
    }
    catch (error){
        console.error('Error occurred', error);
        return res.status(500).json({message: 'Internal Server Error'});
    }
}