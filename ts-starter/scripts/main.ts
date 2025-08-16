import { world, system } from "@minecraft/server";

import { control_door, small_door_below, small_door_upper } from "./blocks";

system.beforeEvents.startup.subscribe((t) => {
  t.blockComponentRegistry.registerCustomComponent("scp:control_door", control_door);
});

system.beforeEvents.startup.subscribe((t) => {
  t.blockComponentRegistry.registerCustomComponent("scp:small_door_below", small_door_below);
});

system.beforeEvents.startup.subscribe((t) => {
  t.blockComponentRegistry.registerCustomComponent("scp:small_door_upper", small_door_upper);
});
