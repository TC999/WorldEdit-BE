import { Player, BlockLocation, TickEvent, BeforeItemUseEvent } from 'mojang-minecraft';
import { getWorldMaxY, getWorldMinY, printDebug, printLog } from './util.js';
import { Server, Vector, setTickTimeout, regionVolume, generateId, regionBounds } from '@notbeer-api';
import { TICKS_TO_DELETE_SESSION, DRAW_SELECTION, WAND_ITEM, NAV_WAND_ITEM, DEFAULT_CHANGE_LIMIT } from '../config.js';

import { Tools } from './tools/tool_manager.js';
import './tools/register_tools.js';
import { History } from '@modules/history.js';
import { Mask } from '@modules/mask.js';
import { Pattern } from '@modules/pattern.js';
import { PlayerUtil } from '@modules/player_util.js';
import { SettingsHotbar } from '@modules/settings_hotbar.js';
import { RegionBuffer } from '@modules/region_buffer.js';
import { Shape } from './shapes/base_shape.js';
import { CuboidShape } from './shapes/cuboid.js';
import { Selection, selectMode } from '@modules/selection.js';

// TODO: Add other selection modes

const playerSessions: Map<string, PlayerSession> = new Map();
const pendingDeletion: Map<string, [number, PlayerSession]> = new Map();

Server.on('playerChangeDimension', ev => {
    playerSessions.get(ev.player.name)?.selection.clear();
});

/**
 * Represents a WorldEdit user's current session with the addon.
 * It manages their selections, operation history, and other things related to WorldEdit per player.
 */
export class PlayerSession {
    /**
    * Is true while a WorldEdit command is being called from an item; false otherwise.
    * @readonly
    */
    public usingItem = false;
    
    /**
    * A pattern created by the pattern picker
    * It's used by custom commands that are called from items.
    */
    public globalPattern = new Pattern();
    
    /**
    * A global mask created by the mask picker and ;gmask.
    * It's used by various commands and operation that are affected by masks such as the ;cyl command and brushes in combination of their own masks.
    */
    public globalMask = new Mask();
    
    /**
    * Whether the copy and cut items should include entities in the clipboard.
    */
    public includeEntities = false;
    
    /**
    * Whether the copy and cut items should include air in the clipboard.
    */
    public includeAir = true;
    
    /**
     * The amount of blocks that can be changed in one operation.
     */
    public changeLimit = DEFAULT_CHANGE_LIMIT == -1 ? Infinity : DEFAULT_CHANGE_LIMIT;

    /**
    * Handles the settings UI created from the config item.
    * Is null when the UI isn't active.
    */
    public settingsHotbar: SettingsHotbar;

    /**
     * The clipboard region created by the player.
     */
    public clipboard: RegionBuffer;
    /**
     * The transformation properties currently on the clipboard
     */
    public clipboardTransform = {
        originalLoc: Vector.ZERO,
        relative: Vector.ZERO,
        rotation: Vector.ZERO,
        flip: Vector.ONE
    }

    public selection: Selection;

    private player: Player;
    private history: History;
    private regions = new Map<string, RegionBuffer>();
        
    constructor(player: Player) {
        this.player = player;
        this.history = new History(this);
        this.selection = new Selection(player);
        
        this.bindTool('selection_wand', WAND_ITEM);
        this.bindTool('navigation_wand', NAV_WAND_ITEM);
        if (PlayerUtil.isHotbarStashed(player)) {
            this.enterSettings();
        }

        for (const tag of player.getTags()) {
            if (tag.startsWith('wedit:defaultTag_')) {
                this.selection.mode = tag.split('_', 2)[1] as selectMode;
            }
        }
    }
    
    /**
    * @return The player that this session handles
    */
    public getPlayer() {
        return this.player;
    }
    
    /**
    * @return The history handler that this session uses
    */
    public getHistory() {
        return this.history;
    }
    
    /**
    * @internal
    */
    reassignPlayer(player: Player) {
        this.player = player;
        this.selection = new Selection(player);
    }
    
    /**
    * Binds a new tool to this session.
    * @param tool The id of the tool being made
    * @param item The id of the item to bind to (null defaults to held item)
    * @param args Optional parameters the tool uses during its construction.
    */
    public bindTool(tool: string, item: string|[string, number]|null, ...args: any[]) {
        if (!item) {
            let stack = Server.player.getHeldItem(this.player);
            item = [stack.id, stack.data];
        } else if (typeof item == 'string') {
            item = [item, 0];
        }
        return Tools.bind(tool, item[0], item[1], this.player, ...args);
    }
    
    /**
    * Tests for a property of a tool in the session's player's main hand.
    * @param item The id of the item with the tool to test (null defaults to held item)
    * @param property The name of the tool's property
    */
    public hasToolProperty(item: string|[string, number]|null, property: string) {
        if (!item) {
            let stack = Server.player.getHeldItem(this.player);
            item = [stack.id, stack.data];
        } else if (typeof item == 'string') {
            item = [item, 0];
        }
        return Tools.hasProperty(item[0], item[1], this.player, property);
    }
    
    /**
    * Sets a property of a tool in the session's player's main hand.
    * @param item The id of the item with the tool to set the property of (null defaults to held item)
    * @param property The name of the tool's property
    * @param value The new value of the tool's property
    */
    public setToolProperty(item: string|[string, number]|null, property: string, value: any) {
        if (!item) {
            let stack = Server.player.getHeldItem(this.player);
            item = [stack.id, stack.data];
        } else if (typeof item == 'string') {
            item = [item, 0];
        }
        return Tools.setProperty(item[0], item[1], this.player, property, value);
    }
    
    /**
    * @param item The id of the item to test (null defaults to held item)
    * @return Whether the session has a tool binded to the player's hand.
    */
    public hasTool(item: string|[string, number]|null) {
        if (!item) {
            let stack = Server.player.getHeldItem(this.player);
            item = [stack.id, stack.data];
        } else if (typeof item == 'string') {
            item = [item, 0];
        }
        return Tools.hasBinding(item[0], item[1], this.player);
    }
    
    /**
    * @param item The id of the item to unbinf from (null defaults to held item)
    * Unbinds a tool from this session's player's hand.
    */
    public unbindTool(item: string|[string, number]|null) {
        if (!item) {
            let stack = Server.player.getHeldItem(this.player);
            item = [stack.id, stack.data];
        } else if (typeof item == 'string') {
            item = [item, 0];
        }
        return Tools.unbind(item[0], item[1], this.player);
    }
    
    /**
    * Triggers the hotbar setting menu to appear.
    */
    public enterSettings() {
        this.settingsHotbar = new SettingsHotbar(this);
    }
    
    /**
    * Triggers the hotbar settings menu to disappear.
    */
    public exitSettings() {
        this.settingsHotbar.exit();
        this.settingsHotbar = null;
    }
    
    public createRegion(isAccurate: boolean) {
        const buffer = new RegionBuffer(isAccurate);
        this.regions.set(buffer.id, buffer);
        return buffer;
    }

    public deleteRegion(buffer: RegionBuffer) {
        this.regions.delete(buffer.id);
    }

    delete() {
        for (const region of this.regions.values()) {
            region.delete();
        }
        this.regions.clear();
        Tools.deleteBindings(this.player);
        this.history.delete();
        this.history = null;
    }
    
    onTick(tick: TickEvent) {
        // Process settingsHotbar
        if (this.settingsHotbar) {
            this.settingsHotbar.onTick(tick);
        } else if (PlayerUtil.isHotbarStashed(this.player)) {
            this.enterSettings();
        }
        
        // Draw Selection
        this.selection?.draw();
    }
    
    onItemUse(ev: BeforeItemUseEvent) {
        if (this.settingsHotbar) {
            this.settingsHotbar.onItemUse(ev);
        }
    }
}

export function getSession(player: Player): PlayerSession {
    const name = player.name;
    if (!playerSessions.has(name)) {
        let session: PlayerSession
        if (pendingDeletion.has(name)) {
            session = pendingDeletion.get(name)[1];
            session.reassignPlayer(player);
            pendingDeletion.delete(name);
        }
        playerSessions.set(name, session ?? new PlayerSession(player));
        printDebug(playerSessions.get(name)?.getPlayer()?.name);
        printDebug(`new Session?: ${!session}`);
    }
    return playerSessions.get(name);
}

export function removeSession(player: string) {
    if (!playerSessions.has(player)) return;

    playerSessions.get(player).selection.clear();
    playerSessions.get(player).globalPattern.clear();
    pendingDeletion.set(player, [TICKS_TO_DELETE_SESSION, playerSessions.get(player)]);
    playerSessions.delete(player);
}

export function hasSession(player: string) {
    return playerSessions.has(player);
}

// Delayed a tick so that it's processed before other listeners
setTickTimeout(() => {
    Server.prependListener('tick', ev => {
        for (const player of pendingDeletion.keys()) {
            const session = pendingDeletion.get(player);
            session[0]--;
            if (session[0] < 0) {
                session[1].delete();
                pendingDeletion.delete(player);
                printLog(`${player}'s session has been deleted.`);
            }
        }
        
        for (const session of playerSessions.values()) {
            session.onTick(ev);
        }
    });
    
    Server.prependListener('beforeItemUse', ev => {
        if (ev.source.id == 'minecraft:player') {
            const name = (ev.source as Player).name;
            playerSessions.get(name)?.onItemUse(ev);
        }
    });
}, 1);
