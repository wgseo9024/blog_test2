import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const interval=Math.max(5,Number(process.env.PUBLISHER_POLL_MINUTES||5))*60_000;
const entry=path.join(path.dirname(fileURLToPath(import.meta.url)),"index.js");
let running=false;
async function run(){if(running)return;running=true;await new Promise((resolve)=>{const child=spawn(process.execPath,[entry,"--save-draft"],{stdio:"inherit",env:{...process.env,AUTO_SAVE_DRAFT:"YES"}});child.on("exit",resolve);child.on("error",resolve)});running=false;}
await run();setInterval(run,interval);console.log(`publisher-app 감시 실행: ${interval/60000}분 간격`);
