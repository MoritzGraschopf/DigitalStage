"use client"

import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";
import {useEffect, useState} from "react";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";

export default function Home() {
    const [conferences, setConferences] = useState<Conference[]>([])
    const {token} = useAuth()

    useEffect(() => {
        const fetchConferences = async () => {
            await fetch("/api/conference", {
                headers: {
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/json"
                }
            }).then(res => res.json())
                .then(data => setConferences(data.conferences))
                .catch(err => console.error(err))
        }

        fetchConferences().then()
    }, [token]);

    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2">
            {conferences.map(conference => (
                <Card key={conference.id}>
                    <CardHeader>
                        <CardTitle>{conference.title}</CardTitle>
                        <CardDescription>
                            {conference.startDate && conference.endDate ? (
                                <>
                                    Von {new Date(conference.startDate).toLocaleDateString("de-DE")} bis{" "}
                                    {new Date(conference.endDate).toLocaleDateString("de-DE")}
                                </>
                            ) : (
                                "Datum nicht verfügbar"
                            )}
                        </CardDescription>

                    </CardHeader>
                    <CardContent>
                        <p>{conference.description}</p>
                    </CardContent>
                    <CardFooter>
                        <Link href={`/app/${conference.link}`}>
                            <Button>
                                Zur Konferenz
                            </Button>
                        </Link>
                    </CardFooter>
                </Card>
            ))}
        </div>
    );
}
