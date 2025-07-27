import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";
import {prisma} from "@/lib/prisma";

export default async function Home() {
    const conferences = await prisma.conference.findMany({
        select: {
            id: true,
            title: true,
            description: true,
            status: true,
            startDate: true,
            endDate: true,
            link: true,
            participationPassword: false,
        }
    });

    return (
        <div className="grid grid-cols-4 gap-2 m-2">
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
