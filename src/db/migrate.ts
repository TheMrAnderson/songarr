import "dotenv/config";
import { openDatabase } from "./database.js";
openDatabase().close();
console.log("SQLite schema is current");
