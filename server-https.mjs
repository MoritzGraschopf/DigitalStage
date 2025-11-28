import https from "https";
import fs from "fs";
import next from "next";

const port = 3000;
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

const httpsOptions = {
    key: fs.readFileSync("./certs/dev-key.pem"),
    cert: fs.readFileSync("./certs/dev-cert.pem"),
};

await app.prepare();

https
    .createServer(httpsOptions, (req, res) => handle(req, res))
    .listen(port, "0.0.0.0", () => {
        console.log(`> HTTPS Next läuft auf https://192.168.68.114:${port}`);
    });
