import { btree, btreeBlock, btreeBlock2 } from "./zettel";
import { btree2 } from "./zettel2";
import { compact, flattenDeep, omit, flatten, maxBy } from "lodash";
import { blocks } from "./blockExamples";

// flattens a tree of blocks, adding parent-uid to all child blocks, as well as depth
// note that if the top node is a page, the parent-uid of the depth=1 will refer to a page, not a block
export const btreeToBArray = (bt, depth = 0, parentUid) => {
  if (!bt || bt.length === 0) {
    return [];
  }
  return flattenDeep(
    bt.map(a => [
      { "parent-uid": parentUid, depth, ...omit(a, "children") },
      ...btreeToBArray(a.children, depth + 1, a.uid)
    ])
  );
};

// restores tree from array generated by btreeToBArray
// note that if the top node is a page, the parent-uid of the depth=1 will refer to a page, not a block
// we should process by depth level, to ensure ancestors exist
export const bArrayToBtree = (ba, allNodes, depth = 0) => {
  // const maxDepth = maxBy(ba, x => x.depth).depth;
  // new Array(maxDepth).fill("").forEach((_, depth) => {
  //   ba.filter(x => x.depth === depth).forEach(f => {});
  // });
  if (!allNodes) {
    allNodes = ba;
  }

  return ba
    .filter(x => x.depth === depth)
    .sort((f, j) => f.order - j.order)
    .map(n => {
      const children = allNodes.filter(x => x["parent-uid"] === n.uid);
      return {
        ...n,
        ...(children.length === 0
          ? {}
          : bArrayToBtree(children, allNodes, depth + 1))
      };
      return n;
    });
};

Array.prototype.move = function(from, to) {
  this.splice(to, 0, this.splice(from, 1)[0]);
};

// calculate minimal amount of moves to get from a to b, assuming all elements exist in both, only a single time
const calculateMinimalMoves = (a, b) => {
  let moves = [];
  let notDone = true;
  while (notDone) {
    notDone = false;
    b.forEach((targetElem, i) => {
      const curLoc = a.indexOf(targetElem);

      if (curLoc !== i) {
        notDone = true;
        moves.push([curLoc, i]);
        a.move(curLoc, i);
      }
    });
  }
  return moves;
};

// takes two blockArrays, and a depth level, and only compares blcoks at that level
const compareDepthSameParent = (ba, ba2, parentUid, depth = 0) => {
  const b = ba.filter(x => x.depth === depth && x["parent-uid"] === parentUid);
  const b2 = ba2.filter(
    x => x.depth === depth && x["parent-uid"] === parentUid
  );
  // find inserts and deletes
  const deletes = b.filter(x => !b2.find(f => x.uid === f.uid));
  const inserts = b2.filter(x => !b.find(f => x.uid === f.uid));
  const ops = [];

  // carry out deletes, checking if it has just been moved to another level
  deletes.forEach(x => {
    const existingBlock = ba2.find(z => z.uid === x.uid);
    if (existingBlock) {
      let baToChange = ba.find(z => z.uid === x.uid);
      baToChange["parent-uid"] = existingBlock["parent-uid"];
      baToChange["depth"] = existingBlock["depth"];
      baToChange["hasMoved"] = true;
    } else {
      ops.push({ type: "remove", uid: x.uid });
    }

    b.splice(b.findIndex(z => z.uid === x.uid), 1);
  });

  // generate blockUids for easier sorting
  const blockUids = b.sort((x, y) => x.order - y.order).map(x => x.uid);

  // then do inserts
  inserts.sort((x, y) => x.order - y.order).forEach(x => {
    const existingBlock = ba.find(z => z.uid === x.uid);
    if (existingBlock) {
      existingBlock["parent-uid"] = parentUid;
      baToChange["depth"] = depth;
      baToChange["hasMoved"] = true;
      blockUids.splice(x.order, 0, x.uid);
    } else {
      blockUids.splice(x.order, 0, x.uid);
      ba.push({ order: x.order, ...ba2.find(z => z.uid === x.uid) });
      ops.push({ type: "create", ...x });
    }
  });

  // now we should have the same blocks, in the same order that Roam would generate
  // so what is left to get the same order?
  const moves = calculateMinimalMoves(blockUids, b2.map(x => x.uid));
  moves.forEach(f => {
    ops.push({
      type: "move",
      uid: blockUids[f[0]],
      order: f[1],
      "parent-uid": ba.find(z => z.uid === blockUids[f[0]])["parent-uid"]
    });
  });

  // see if there are any parent-uid moves that are coming from above, which do not need reordering
  blockUids
    .filter(
      (x, i) =>
        !moves.some(z => i === z[0]) && ba.find(z => z.uid === x).hasMoved
    )
    .forEach(x => {
      const block = ba.find(z => z.uid === x);
      ops.push({
        type: "move",
        uid: x,
        order: block.order,
        "parent-uid": block["parent-uid"]
      });
    });
  return ops;
};

// assumes a is a strict subset of b, extracts changes, and orders them by depth
export const simpleCompare = (a, b) => {
  const ba = btreeToBArray(a);
  const bb = btreeToBArray(b);
  const newBlocks = bb.filter(x => !ba.find(z => z.uid === x.uid));
  newBlocks.sort((j, k) => j.depth - k.depth);
  const updatedBlocks = bb.filter(block => {
    const matchingBlock = ba.find(z => z.uid === block.uid);
    if (matchingBlock && matchingBlock.string !== block.string) {
      return true;
    }
  });
  return { newBlocks, updatedBlocks };
};

// we are first creating and then sorting... should we do both at the same time, or can we reconcile them afterwards?
// there are three cases:
//   - pure move
//   - creation (block that didn't exist before)
//   - block that was moved from another level (also needs new parent-uid)

// given two btrees, calculate differences, and operations needed to turn one into the other in terms of Roam API
// there are two kinds of changes: structural (blocks with a certain uids move, inserts or deletes) and
// content: string of block changes
// these should be dealt with differently
// the position of each node is determined by its parent node and order, a move is a change of those
// so first we could calculate a list of existing blocks that need to move
// however, we can't move a block to a parentUid that doesn't exist
// so we also need to calculate blocks that we need to create, and maybe do that first? This is the tricky part
// do we need a way to transform between a tree structure and a flat structure?
export const btreeDiff = (bt, bt2) => {
  let ba = btreeToBArray(bt);
  const ba2 = btreeToBArray(bt2);
  const maxDepth = maxBy(ba, x => x.depth).depth;

  const res = [...new Array(maxDepth + 1).keys()].map(depth => {
    const depthBlocks = ba.filter(x => x.depth === depth);
    const parentUids = [...new Set(depthBlocks.map(x => x["parent-uid"]))];
    return parentUids.map(p => {
      const ary = bArrayToBtree(ba);
      ba = btreeToBArray(ary);

      return compareDepthSameParent(ba, ba2, p, depth);
    });
    compareDepth(ba, ba2, d);
  });
  return compact(flattenDeep(res));
};

// console.log(simpleCompare(blocks.b, blocks.a));