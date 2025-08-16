import {
  BlockComponentOnPlaceEvent,
  BlockComponentPlayerInteractEvent,
  CustomComponentParameters,
  system,
  world,
} from "@minecraft/server";

export const control_door = {
  onPlayerInteract(arg0: BlockComponentPlayerInteractEvent, arg1: CustomComponentParameters) {
    const block = arg0.block;

    // @ts-ignore
    const control = arg1.params.control;
    const state = block.permutation.getState(control);

    if (state == 0) {
      block.setPermutation(block.permutation.withState(control, 1));

      for (let index = 2; index <= 10; index++) {
        system.runTimeout(
          () => {
            block.setPermutation(block.permutation.withState(control, index));
          },
          3 * (index - 1)
        );
      }
    }

    if (state == 10) {
      block.setPermutation(block.permutation.withState(control, 9));

      let a = 0;
      for (let index = 8; index >= 0; index--) {
        a += 1;
        system.runTimeout(() => {
          block.setPermutation(block.permutation.withState(control, index));
        }, 3 * a);
      }
    }
  },
};

export const small_door_below = {
  onPlace(arg0: BlockComponentOnPlaceEvent, arg1: CustomComponentParameters) {
    const dimension = world.getDimension("overworld");
    const block = arg0.block;
    const x = block.location.x;
    const y = block.location.y;
    const z = block.location.z;

    // @ts-ignore
    const direction = arg1.params.direction;
    const face = block.permutation.getState(direction);

    dimension.runCommand(
      "setblock " +
        x +
        " " +
        (y + 1) +
        " " +
        z +
        ' scp:small_door_upper["door:open"="false","minecraft:cardinal_direction"="' +
        face +
        '"]'
    );
  },

  onPlayerInteract(arg0: BlockComponentPlayerInteractEvent, arg1: CustomComponentParameters) {
    const block = arg0.block;

    // @ts-ignore
    const control = arg1.params.control;
    // @ts-ignore
    const direction = arg1.params.direction;
    const face = block.permutation.getState(direction);
    let state = block.permutation.getState(control);

    const x = block.location.x;
    const y = block.location.y;
    const z = block.location.z;

    const location = block.location;
    location.x += 0.5;
    location.z += 0.5;

    const dimension = world.getDimension("overworld");

    if (face == "north" || face == "south") {
      block.setPermutation(block.permutation.withState(control, "null"));

      // @ts-ignore
      const entity = dimension.spawnEntity("scp:small_door_entity_north", location);
      if (state == "false") {
        dimension.playSound("scp.small_door_open", location);
        entity.setProperty("door:open", false);
        state = "true";
      } else {
        dimension.playSound("scp.small_door_close", location);
        entity.setProperty("door:open", true);
        state = "false";
      }

      system.runTimeout(() => {
        entity.remove();
        block.setPermutation(block.permutation.withState(control, state));
      }, 29);
    } else {
      block.setPermutation(block.permutation.withState(control, "null"));

      // @ts-ignore
      const entity = dimension.spawnEntity("scp:small_door_entity_west", location);
      if (state == "false") {
        dimension.playSound("scp.small_door_open", location);
        entity.setProperty("door:open", false);
        state = "true";
      } else {
        dimension.playSound("scp.small_door_close", location);
        entity.setProperty("door:open", true);
        state = "false";
      }

      system.runTimeout(() => {
        entity.remove();
        block.setPermutation(block.permutation.withState(control, state));
      }, 29);
    }
  },
};

export const small_door_upper = {
  onPlayerInteract(arg0: BlockComponentPlayerInteractEvent, arg1: CustomComponentParameters) {},
};
