import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";

const dummyData = [
    {
        id: 1,
        key: Math.random().toString(36).substring(7),
        titel: "Titel",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    },
    {
        id: 2,
        key: Math.random().toString(36).substring(7),
        titel: "Titel",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    },
    {
        id: 3,
        key: Math.random().toString(36).substring(7),
        titel: "Titel",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    },
    {
        id: 4,
        key: Math.random().toString(36).substring(7),
        titel: "Titel",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    },
]

export default function Home() {
    return (
        <div className="grid grid-cols-4 gap-2 m-2">
            {dummyData.map((item) => (
                <Card key={item.id}>
                    <CardHeader>
                        <CardTitle>{item.titel}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>{item.description}</p>
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                        <Button className="w-full" asChild>
                            <Link href={"/app/" + item.key}>
                                Beitreten
                            </Link>
                        </Button>
                    </CardFooter>
                </Card>
            ))}
        </div>
    );
}
