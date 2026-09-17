// Baa-ton v1 task-profile names and mandatory read-only defaults.
const names = ['planning', 'quick', 'balanced', 'implementation', 'sustained', 'review', 'deep-review'];
const readOnlyNames = new Set(['planning', 'review', 'deep-review']);

export function resolveTaskProfile(task, config) {
  if (task.taskProfile === undefined) return task;
  const name = task.taskProfile;
  if (!names.includes(name)) throw new Error(`Unknown taskProfile: ${name}`);
  if (task.launchProfile !== undefined) throw new Error(`${task.id}: use taskProfile or launchProfile, not both`);
  if (!config || config.version !== 1 || !config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles)) throw new Error('Named task profiles require a version 1 .baa-ton/config.json with profiles');
  const selected = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
  if (!selected || typeof selected !== 'object' || Array.isArray(selected) || !selected.launchProfile) throw new Error(`Task profile ${name} has no exact launchProfile in .baa-ton/config.json`);
  if (selected.agentKind !== undefined && (typeof selected.agentKind !== 'string' || !selected.agentKind.trim())) throw new Error(`Task profile ${name} has an invalid agentKind`);
  if (task.agentKind !== undefined && selected.agentKind !== undefined && task.agentKind !== selected.agentKind) throw new Error(`${task.id}: agentKind conflicts with task profile ${name}`);
  if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(selected.launchProfile.thinking)) throw new Error(`Task profile ${name} has an invalid thinking level`);
  return { ...task, agentKind: task.agentKind ?? selected.agentKind ?? 'pi', readOnly: task.readOnly === true || selected.readOnly === true || readOnlyNames.has(name), launchProfile: selected.launchProfile };
}
