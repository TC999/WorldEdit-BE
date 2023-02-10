import { Cardinal } from "@modules/directions.js";
import { Mask } from "@modules/mask.js";
import { Vector, regionIterateBlocks } from "@notbeer-api";
import { Player } from "@minecraft/server";
import { PlayerSession } from "../sessions.js";
import { Tool } from "./base_tool.js";
import { Tools } from "./tool_manager.js";
import { RegionBuffer } from "@modules/region_buffer.js";

class StackerTool extends Tool {
  public range: number;
  public mask: Mask;

  permission = "worldedit.region.stack";
  useOn = function* (self: Tool, player: Player, session: PlayerSession, loc: Vector) {
    const dim = player.dimension;
    const dir = new Cardinal(Cardinal.Dir.BACK).getDirection(player);
    const start = loc.add(dir);
    if (!this.mask.matchesBlock(start, dim)) {
      return;
    }
    let end = loc;
    for (let i = 0; i < this.range; i++) {
      end = end.add(dir);
      if (!this.mask.matchesBlock(end.add(dir), dim)) break;
    }
    const history = session.getHistory();
    const record = history.record();
    const tempStack = new RegionBuffer(true);
    try {
      yield history.addUndoStructure(record, start, end, "any");

      yield tempStack.save(loc, loc, dim);
      for (const pos of regionIterateBlocks(start, end)) {
        tempStack.load(pos, dim);
      }
      yield history.addRedoStructure(record, start, end, "any");
      history.commit(record);
    } catch (e) {
      history.cancel(record);
      throw e;
    } finally {
      tempStack.delete();
    }
  };

  constructor(range: number, mask: Mask) {
    super();
    this.range = range;
    this.mask = mask;
  }
}

Tools.register(StackerTool, "stacker_wand");