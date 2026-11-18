// rzAI Mobil — model bu Web Worker icinde calisir, arayuz donmaz.
import { WebWorkerMLCEngineHandler } from "./vendor/web-llm.js";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
