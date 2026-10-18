import { createPrismaClient } from "./database.js";
import { createApp } from "./app.js";
import { getJwtSecret } from "./config.js";

const secret = getJwtSecret();
const prisma = createPrismaClient();
const app = createApp(prisma, secret);
app.listen(3000, () => { console.log("Server is running on port 3000"); });
