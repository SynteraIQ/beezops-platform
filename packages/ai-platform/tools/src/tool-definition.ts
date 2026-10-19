export interface ToolDefinition<Input, Output> {
  id: string;
  version: string;
  description: string;
  execute(input: Input): Promise<Output>;
}
