declare module "wink-bm25-text-search" {
      type Bm25Doc = Record<string, unknown>;

      interface Bm25Engine {
            defineConfig(config: Record<string, unknown>): void;
            definePrepTasks(tasks: Array<(input: unknown) => unknown>): void;
            addDoc(doc: Bm25Doc, id: string | number): void;
            consolidate(): void;
            search(query: string, limit?: number): unknown[];
      }

      export default function bm25(): Bm25Engine;
}
