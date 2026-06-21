import { readFileSync } from "fs";

const path =
  "C:/Users/Maciel/.cursor/projects/c-Users-Maciel-postarigr/agent-transcripts/e484b724-9375-4d7d-8055-9fa3f8594b36/e484b724-9375-4d7d-8055-9fa3f8594b36.jsonl";
const text = readFileSync(path, "utf8");
const ids = [...text.matchAll(/dea1e690-[0-9a-f-]{36}|e69b6f8d-[0-9a-f-]{36}/gi)].map(
  (m) => m[0],
);
console.log(JSON.stringify([...new Set(ids)], null, 2));
