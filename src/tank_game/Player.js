import Entity from './Entity';
import Bullet from './Bullet';

var template = `
function mapat(x, y) {
  if (this[y] && this[y][x])
    return this[y][x].type;
  else
    return null;
}

function entat(x, y, type) {
  return this.filter(function(e) { return e.x === x && e.y === y &&
    (!type || e.type === type); });
}

onmessage = function(msg) {
  var map = msg.data.map;
  map.at = mapat;

  var entities = msg.data.entities;
  entities.at = entat;

  var me = msg.data.me;
  takeTurn(map, entities, me);
}

function moveForward() {
  postMessage({turn: 'moveForward'});
}

function turnRight() {
  postMessage({turn: 'turnRight'});
}
function turnLeft() {
  postMessage({turn: 'turnLeft'});
}

function fire() {
  postMessage({turn: 'fire'});
}

function doNothing() {
  postMessage({turn: 'nothing'});
}

console = {
  log: function() {
    postMessage({log: Array.prototype.slice.apply(arguments)});
  }
}
function say(message) {
  postMessage({say: message});
}

`;

// This isn't totally safe from people messing with things... see the `jailed`
// npm module for a better sandbox using iframes as well as web workers.
class PlayerWorker {
  constructor(code) {
    var blob = new Blob([template, code]);
    this.blobURL = window.URL.createObjectURL(blob);
    this.worker = new Worker(this.blobURL);
  }

  takeTurn(inputState, cb) {
    this.worker.onmessage = function(msg) {
      const data = msg.data;
      if (data.log) {
        console.log.apply(console, data.log);
        return;
      }
      if (data.say) {
        // TODO: UI for messages/taunts
        console.log(`Player said ${data.say}`);
        return;
      }

      // TODO: safeguard against:
      // * making more than one move per turn
      // * calling postMessage directly with bad data
      // * better error handling
      var response = data;
      cb(response);
    };

    this.worker.onerror = function(err) {
      throw `got worker error ${err}`;
    };

    this.worker.postMessage(inputState);
  }

  shutdown() {
    window.URL.revokeObjectURL(this.blobURL);
    this.worker.terminate();
  }
}

export default class Player extends Entity {
  constructor(i, startPos, source) {
    super(startPos);
    this.playerId = i;
    this.worker = new PlayerWorker(source);
    this.turn = 0;
  }

  tick(game, cb) {
    // only move every other tick
    if (++this.turn % 2 === 0) {
      return cb();
    }

    this.worker.takeTurn({
      map: game.map,
      entities: game.entities.map(e => e.serialize()),
      me: this.serialize()
    }, turn => {
      this.evaluateMove(game, turn);
      super.tick(game, cb);
    });
  }

  destroy() {
    super.destroy();
    this.worker.shutdown();
  }

  get sprite() {
    return `tank-${this.playerId}-${this.facing}`;
  }

  serialize() {
    return Object.assign(super.serialize(), {
      playerId: this.playerId
    });
  }

  damage(weapon) {
    this.destroy();
  }

  evaluateMove(game, turn) {
    if (!turn) {
      // TODO: disqualify?
      return;
    }

    const facings = ['north', 'east', 'south', 'west'];
    var vector = Entity.vector(this.facing);

    switch(turn.turn) {
    case 'moveForward':
      var newPos = {x: this.x + vector.x, y: this.y + vector.y};
      if (game.getCell(newPos).type === 'empty' &&
          game.getEntities(newPos).length === 0) {
        // TODO: disqualify rather than just no-op the move?
        Object.assign(this, newPos);
      }
      break;
    case 'turnRight':
      this.facing = facings[this.realMod(facings.indexOf(this.facing) + 1, facings.length)];
      break;
    case 'turnLeft':
      this.facing = facings[this.realMod(facings.indexOf(this.facing) - 1, facings.length)];
      break;
    case 'fire':
      var bulletPos = {x: this.x + vector.x, y: this.y + vector.y, facing: this.facing};
      var bullet = new Bullet(bulletPos);
      if (bullet.check(game)) {
        game.spawn(bullet);
      }
      break;
    case 'nothing':
      break;
    }
  }

  // yay
  realMod(n, m) {
    return ((n % m) + m) % m;
  }
}
