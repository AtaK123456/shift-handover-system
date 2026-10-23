import { createPrismaClient } from "./database.js";
import { createApp } from "./app.js";
import { getJwtSecret, getRegistrationCode } from "./config.js";

const secret = getJwtSecret();
const registrationCode = getRegistrationCode();
const prisma = createPrismaClient();
const app = createApp(prisma, secret, { registrationCode });
app.listen(3000, () => { console.log("Server is running on port 3000"); });
