import {
  Entity,
  Player,
  PlayerSpawnAfterEvent,
  StartupEvent,
  system,
  world
} from "@minecraft/server";
import { small_door_upper, small_door_below } from "./block.js";

// 钥匙卡重播信号已停用：Molang 侧不存在可读取实体标签的 query
// （query.any_tag / query.all_tags 只作用于物品和方块），
// 未知 query 静默返回 0.0，标签条件恒为真，无法制造 false -> true 边沿。
// 因此不再给玩家写入 scp_keycard_animation_reset 标签，避免留下无人读取的残留状态。
// 后续若改用实体属性或玩家客户端实体驱动重播，再恢复对应的信号通道。

// 辅助实体始终位于玩家视线前方 2.5 格。
const LIMIT_REACH_DISTANCE = 2.5;
// 在原有向下 0.3 格的基础上再向下 0.2 格，总偏移为 0.5 格。
const LIMIT_REACH_VERTICAL_OFFSET = 0.5;
const LIMIT_REACH_ENTITY_TYPE = "scp:limit_reach";
const MINECRAFT_DIMENSIONS = ["overworld", "nether", "the_end"];

// 每名玩家拥有独立的辅助实体，键是玩家的唯一 ID。
const limitReachEntities = new Map<string, Entity>();
let hasCleanedLegacyEntities = false;

// 脚本启动时注册双格门上下两部分使用的自定义组件。
system.beforeEvents.startup.subscribe((event: StartupEvent) => {
  event.blockComponentRegistry.registerCustomComponent("scp:small_door_upper", small_door_upper);
  event.blockComponentRegistry.registerCustomComponent("scp:small_door_below", small_door_below);

  // 脚本重载时玩家可能已经在线，下一 tick 为所有在线玩家恢复辅助实体。
  system.run(initializeLimitReachEntities);
});

world.afterEvents.playerSpawn.subscribe((event: PlayerSpawnAfterEvent) => {
  // 死亡重生不会重新清理实体，只有首次进入世界时才执行初始化。
  if (!event.initialSpawn) {
    return;
  }

  // 脚本重载后只在第一个玩家进入时清除旧实体，避免清理其他玩家刚创建的实体。
  if (!hasCleanedLegacyEntities) {
    initializeLimitReachEntities();
  }

  const previousEntity = limitReachEntities.get(event.player.id);

  if (!previousEntity?.isValid) {
    limitReachEntities.set(event.player.id, createLimitReachEntity(event.player));
  }
});

world.afterEvents.playerLeave.subscribe((event) => {
  const entity = limitReachEntities.get(event.playerId);

  if (entity?.isValid) {
    entity.remove();
  }

  limitReachEntities.delete(event.playerId);
});

// 每 tick 分别根据每名玩家的头部位置和视线方向更新对应实体。
system.runInterval(() => {
  const players = new Map(world.getAllPlayers().map((player) => [player.id, player]));

  for (const [playerId, entity] of limitReachEntities) {
    const player = players.get(playerId);

    if (!player) {
      if (entity.isValid) {
        entity.remove();
      }

      limitReachEntities.delete(playerId);
      continue;
    }

    let currentEntity = entity;

    if (!currentEntity.isValid) {
      // 实体被命令或其他玩法删除后，只重建对应玩家的实体。
      currentEntity = createLimitReachEntity(player);
      limitReachEntities.set(playerId, currentEntity);
    }

    const direction = player.getViewDirection();
    const location = player.getHeadLocation();

    // 使用视线向量计算目标点，支持玩家俯视、仰视和跨维度移动。
    currentEntity.teleport({
      x: location.x + direction.x * LIMIT_REACH_DISTANCE,
      y: location.y + direction.y * LIMIT_REACH_DISTANCE - LIMIT_REACH_VERTICAL_OFFSET,
      z: location.z + direction.z * LIMIT_REACH_DISTANCE,
    }, { dimension: player.dimension });
  }
}, 1);

// 创建不可见且无粒子效果的触及范围辅助实体。
function createLimitReachEntity(player: Player) {
  const entity = player.dimension.spawnEntity(LIMIT_REACH_ENTITY_TYPE as never, player.location);
  entity.addEffect("invisibility", 20000000, { showParticles: false });
  return entity;
}

// 清理旧实体后，为当前所有在线玩家各创建一只新实体。
function initializeLimitReachEntities() {
  removeAllLimitReachEntities();

  for (const player of world.getAllPlayers()) {
    limitReachEntities.set(player.id, createLimitReachEntity(player));
  }

  hasCleanedLegacyEntities = true;
}

// 跨三个维度清理旧存档中遗留的辅助实体，避免重复生成。
function removeAllLimitReachEntities() {
  for (const dimensionId of MINECRAFT_DIMENSIONS) {
    const dimension = world.getDimension(dimensionId);

    for (const entity of dimension.getEntities({ type: LIMIT_REACH_ENTITY_TYPE })) {
      entity.remove();
    }
  }

  limitReachEntities.clear();
}
