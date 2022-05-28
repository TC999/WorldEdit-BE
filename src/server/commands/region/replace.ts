import { PlayerSession } from '../../sessions.js';
import { registerCommand } from '../register_commands.js';
import { BlockLocation } from 'mojang-minecraft';
import { Jobs } from '@modules/jobs.js';
import { Vector } from '@notbeer-api';
import { assertSelection, assertCanBuildWithin } from '@modules/assert.js';
import { Mask } from '@modules/mask.js';
import { RawText } from '@notbeer-api';

const registerInformation = {
    name: 'replace',
    permission: 'worldedit.region.replace',
    description: 'commands.wedit:replace.description',
    usage: [
        {
            name: 'mask',
            type: 'Mask'
        }, {
            name: 'pattern',
            type: 'Pattern'
        }
    ]
};

function* getAffectedBlocks(session: PlayerSession, mask: Mask): Generator<void, BlockLocation[]> {
    let blocks: BlockLocation[] = [];
    const dim = session.getPlayer().dimension;
    let i = 0;
    for (const blockLoc of session.selection.getBlocks()) {
        if (mask.matchesBlock(blockLoc, dim)) {
            blocks.push(blockLoc);
        }
        yield;
    }
    return blocks;
}

registerCommand(registerInformation, function* (session, builder, args) {
    assertSelection(session);
    assertCanBuildWithin(builder.dimension, ...session.selection.getRange());
    if (args.get('_using_item') && session.globalPattern.empty()) {
        throw RawText.translate('worldEdit.selectionFill.noPattern');
    }
    
    const mask = args.get('_using_item') ?  session.globalMask : args.get('mask');
    const pattern = args.get('_using_item') ? session.globalPattern : args.get('pattern');
    
    const job = Jobs.startJob(session, 2, session.selection.getRange());
    const [shape, loc] = session.selection.getShape();
    const count = yield* Jobs.perform(job, shape.generate(loc, pattern, mask, session));
    Jobs.finishJob(job);

    return RawText.translate('commands.blocks.wedit:changed').with(`${count}`);
});
