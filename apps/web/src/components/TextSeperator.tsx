import React from "react";
import {Separator} from "@/components/ui/separator";

interface TextSeperatorProps {
    textContent: string;
}

const TextSeperator: React.FC<TextSeperatorProps> = ({textContent}) => {
    return (
        <Separator className="my-4 flex justify-center items-center">
            <span className="font-semibold bg-background px-2">{textContent}</span>
        </Separator>
    )
}

export default TextSeperator