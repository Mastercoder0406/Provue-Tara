import * as dotenv from "dotenv";
dotenv.config();

import "./ingest"; // runs ingest if tables are empty

import { app } from "../src/server"; // your existing server

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
    console.log(`🚀 Tara running on port ${PORT}`);
});