import React from "react";
import { Input } from "@/components/ui/input";

const PASSWORD_RULES =
    "minlength: 8; allowed: [a-z,A-Z,0-9,-_.!@#$%^&*];";

export function NewPasswordInput(
    props: React.ComponentProps<typeof Input>
) {
    const ref = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        // Apple erwartet das Attribut lowercase: "passwordrules"
        ref.current?.setAttribute("passwordrules", PASSWORD_RULES);
    }, []);

    return (
        <Input
            {...props}
            ref={ref}
            type="password"
            id="new-password"
            name="new-password"
            autoComplete="new-password"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
        />
    );
}
