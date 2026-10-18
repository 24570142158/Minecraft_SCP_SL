import { 
  Block,
  BlockComponentBlockBreakEvent,
  BlockComponentPlayerInteractEvent,
  BlockComponentPlayerPlaceBeforeEvent,
  BlockPermutation,
  CustomComponentParameters,
  Dimension,
  system,
  Vector3
} from "@minecraft/server";

// 双格门由两个不同方块组成；上半部分只由脚本生成。
const AIR_BLOCK = "minecraft:air";
const SMALL_DOOR_UPPER = "scp:small_door_upper";
const SMALL_DOOR_BELOW = "scp:small_door_below";

type DoorHalf = "upper" | "below";
// false/true 是稳定状态，其余值是开关动画期间的过渡状态。
type DoorState = "false" | "true" | "ft" | "f-t" | "tf" | "t-f";

interface DoorComponentParams {
  control: string;
  direction: string;
}

interface DoorPart {
  location: Vector3;
  typeId: string;
}

export const small_door_upper = {
  onBreak: (event: BlockComponentBlockBreakEvent) => {
    // 破坏上半门时同步清除下半门。
    removeDoorCounterpart(event, "below");
  },
  onPlayerInteract: (event: BlockComponentPlayerInteractEvent, parameters: CustomComponentParameters) => {
    // 点击上半门时，将下方方块作为需要同步的另一半。
    const location = { ...event.block.location, y: event.block.location.y - 1 };
    interactWithSmallDoor(event, parameters, "below", location);
  }
}

export const small_door_below = {
  beforeOnPlayerPlace: (event: BlockComponentPlayerPlaceBeforeEvent, parameters: CustomComponentParameters) => {
    const lowerLocation = { ...event.block.location };
    const upperLocation = { ...lowerLocation, y: lowerLocation.y + 1 };
    const upperBlock = event.dimension.getBlock(upperLocation);

    // 上方空间不足时取消放置，避免生成残缺的双格门。
    if (!upperBlock?.isAir) {
      event.cancel = true;
      return;
    }

    const params = parameters.params as DoorComponentParams;
    const dimension = event.dimension;

    // 等待下半门完成放置后，再读取最终朝向并生成上半门。
    system.run(() => {
      const lowerBlock = dimension.getBlock(lowerLocation);
      const currentUpperBlock = dimension.getBlock(upperLocation);

      if (lowerBlock?.typeId !== SMALL_DOOR_BELOW || !currentUpperBlock?.isAir) {
        return;
      }

      const direction = getCustomBlockState(lowerBlock, params.direction);

      if (typeof direction !== "string") {
        return;
      }

      const upperPermutation = BlockPermutation.resolve(SMALL_DOOR_UPPER as never)
        .withState(params.control as never, "false" as never)
        .withState(params.direction as never, direction as never);
      currentUpperBlock.setPermutation(upperPermutation);
    });
  },
  onBreak: (event: BlockComponentBlockBreakEvent) => {
    // 破坏下半门时同步清除上半门。
    removeDoorCounterpart(event, "upper");
  },
  onPlayerInteract: (event: BlockComponentPlayerInteractEvent, parameters: CustomComponentParameters) => {
    // 点击下半门时，将上方方块作为需要同步的另一半。
    const location = { ...event.block.location, y: event.block.location.y + 1 };
    interactWithSmallDoor(event, parameters, "upper", location);
  }
}

// 只在相邻方块确实是门的另一半时清除，避免误删普通方块。
function removeDoorCounterpart(event: BlockComponentBlockBreakEvent, otherHalf: DoorHalf) {
  const yOffset = otherHalf === "upper" ? 1 : -1;
  const location = { ...event.block.location, y: event.block.location.y + yOffset };
  const expectedTypeId = otherHalf === "upper" ? SMALL_DOOR_UPPER : SMALL_DOOR_BELOW;
  const counterpart = event.dimension.getBlock(location);

  if (counterpart?.typeId === expectedTypeId) {
    counterpart.setType(AIR_BLOCK);
  }
}

function interactWithSmallDoor(
  event: BlockComponentPlayerInteractEvent,
  parameters: CustomComponentParameters,
  otherHalf: DoorHalf,
  otherLocation: Vector3
) {
  const params = parameters.params as DoorComponentParams;
  const currentState = getCustomBlockState(event.block, params.control);

  // 过渡状态期间忽略再次点击，防止多个动画和计时器同时运行。
  if (currentState !== "false" && currentState !== "true") {
    return;
  }

  const otherBlock = event.dimension.getBlock(otherLocation);
  const otherTypeId = `scp:small_door_${otherHalf}`;

  // 门的另一半缺失时不启动动画，避免上下状态失去同步。
  if (otherBlock?.typeId !== otherTypeId) {
    return;
  }

  const direction = getCustomBlockState(event.block, params.direction);

  if (typeof direction !== "string") {
    return;
  }

  const parts: DoorPart[] = [
    { location: event.block.location, typeId: event.block.typeId },
    { location: otherLocation, typeId: otherTypeId }
  ];
  const animationLocation = {
    x: event.block.location.x + 0.5,
    y: Math.min(event.block.location.y, otherLocation.y),
    z: event.block.location.z + 0.5
  };

  // 无论点击哪一半，都以门底部中心作为动画实体的生成位置。
  animateDoor(
    event.dimension,
    parts,
    params.control,
    direction,
    currentState === "false",
    animationLocation
  );
}

function animateDoor(
  dimension: Dimension,
  parts: DoorPart[],
  controlState: string,
  direction: string,
  isOpening: boolean,
  animationLocation: Vector3
) {
  // 开门与关门共用同一状态机，仅过渡状态和中间切换时间不同。
  const initialState: DoorState = isOpening ? "ft" : "tf";
  const transitionState: DoorState = isOpening ? "f-t" : "t-f";
  const finalState: DoorState = isOpening ? "true" : "false";
  const transitionTick = isOpening ? 20 : 10;
  // 门模型只区分南北轴和东西轴，因此只需要两档根骨骼旋转。
  const animationRotation = direction === "north" || direction === "south" ? 180 : 90;

  // 先隐藏实体方块模型，再同步方向和开关属性，最后允许动画控制器播放。
  setDoorState(dimension, parts, controlState, initialState);
  const animationEntity = dimension.spawnEntity("scp:small_door" as never, animationLocation);
  animationEntity.setProperty("door:rotation", animationRotation);
  animationEntity.setProperty("door:open", !isOpening);
  animationEntity.setProperty("door:animate", true);

  // 在动画中段切换碰撞箱，避免玩家被正在移动的门体卡住。
  system.runTimeout(() => {
    setDoorState(dimension, parts, controlState, transitionState);
  }, transitionTick);

  // 30 tick 后恢复稳定的开启或关闭方块状态。
  system.runTimeout(() => {
    setDoorState(dimension, parts, controlState, finalState);
  }, 30);

  // 方块状态恢复后立即删除临时动画实体。
  system.runTimeout(() => {
    if (animationEntity.isValid) {
      animationEntity.remove();
    }
  }, 31);
}

// 每次都重新获取方块并核对类型，门被中途破坏时不会修改其他方块。
function setDoorState(
  dimension: Dimension,
  parts: DoorPart[],
  controlState: string,
  state: DoorState
) {
  for (const part of parts) {
    const block: Block | undefined = dimension.getBlock(part.location);

    if (block?.typeId === part.typeId) {
      block.setPermutation(block.permutation.withState(controlState as never, state as never));
    }
  }
}

// Minecraft 类型声明不包含自定义状态名，类型断言统一限制在此边界。
function getCustomBlockState(block: Block, stateName: string) {
  return block.permutation.getState(stateName as never);
}
