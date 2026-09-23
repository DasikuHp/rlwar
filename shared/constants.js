// Constantes del juego (inspiradas en el Graphwar original, src/GraphServer/Constants.java)
// Modo rápido para tests (GW_FAST=1): turnos y animaciones más cortos.
const FAST = typeof process !== 'undefined' && !!process.env && process.env.GW_FAST === '1'; // también en el navegador (spec/08 §9.3)
export const PLANE = { xMin: -25, xMax: 25, yMin: -15, yMax: 15 };
export const HIT_RADIUS = 0.7;        // distancia a la que un disparo mata (el original: ~0.5u)
export const OBSTACLE_MARGIN = 0.06;  // margen de colisión de obstáculos
export const STEP = 0.01;             // paso de integración (longitud de arco)
export const MAX_STEPS = 20000;       // longitud máxima de trayectoria (200 unidades)
export const MAX_STEEPNESS = 1e7;     // pendiente a partir de la cual la función "explota"
export const TURN_TIME = FAST ? 15000 : 60000;       // ms por turno
export const NEXT_TURN_DELAY = FAST ? 300 : 1200;    // ms tras el disparo antes del siguiente turno
export const SHOT_SPEED = FAST ? 250 : 55;           // unidades/segundo para la animación
export const NETWORK_STEP = 0.12;     // resolución de la trayectoria enviada por red
export const MAX_PLAYERS = 8;
export const SOLDIERS_PER_PLAYER = 2;
// STALL_SHOTS ya no renueva el mapa (spec/01 §10.4): solo escala "disparos sin bajas" del ojo Reloj; tope duro de disparos
export const STALL_SHOTS = FAST ? 4 : 8;
export const MAX_SHOTS = FAST ? 40 : 90;
// Movimiento tras disparar (spec/01 §1)
export const BITE_RADIUS = 0.78;     // bocado de cada explosión (12 px del original; spec/01 §10.1)
export const MOVE_RADIUS = 2;         // radio máximo del movimiento (u)
export const BODY = 0.5;              // cuerpo del soldado: distancia mínima a obstáculos y bordes
export const MIN_SEPARATION = 1.0;    // distancia mínima entre centros de dos soldados vivos
export const MOVE_TIME = FAST ? 400 : 8000;  // ms de margen para elegir destino tras ver el tiro
export const SLIDE_R_STEP = 0.05;     // paso radial de la rejilla polar del deslizamiento
export const SLIDE_DEG_STEP = 5;      // paso angular (grados) de la rejilla polar
export const MOVE_DIRS = 8;           // direcciones de los destinos candidatos (0° = +x)
// Límites del laboratorio (spec/00 §6): nada que llegue de fuera puede colgar el servidor
export const LIMITS = {
  blocks: 64, wires: 256, units: 512, params: 2_000_000,
  candidatesMin: 4, candidatesMax: 64, moves: 9,
  genomeBytes: 48 * 1024 * 1024, nets: 500, gamesPerNet: 200, eventsPerGame: 5000,
};
export const TEAMS = { LEFT: 'left', RIGHT: 'right' };
export const MODES = { FUNCTION: 'function', ODE1: 'ode1', ODE2: 'ode2' };
export const MODE_LABELS = { function: 'y =', ode1: "y' =", ode2: "y'' =" };
