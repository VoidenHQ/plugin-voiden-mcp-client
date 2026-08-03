/**
 * Starter JSON templates generated from a discovered tool's inputSchema or a
 * discovered prompt's argument list — populated into the args editor the
 * moment a capability is selected, so the user edits real placeholder values
 * instead of typing a JSON object from scratch.
 */

function placeholderForType(schemaType: string | undefined): any {
  switch (schemaType) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
    default:
      return '';
  }
}

export function toolSchemaToTemplate(inputSchema: any): string {
  const properties = inputSchema?.properties;
  if (!properties || typeof properties !== 'object') return '{}';
  const template: Record<string, any> = {};
  for (const [key, def] of Object.entries<any>(properties)) {
    template[key] = placeholderForType(def?.type);
  }
  return JSON.stringify(template, null, 2);
}

export function promptArgsToTemplate(args: Array<{ name: string }> | undefined): string {
  if (!args?.length) return '{}';
  const template: Record<string, string> = {};
  for (const arg of args) {
    if (arg?.name) template[arg.name] = '';
  }
  return JSON.stringify(template, null, 2);
}
