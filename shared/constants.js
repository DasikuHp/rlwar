// Constantes del juego (inspiradas en el Graphwar original, src/GraphServer/Constants.java)
// Modo rápido para tests (GW_FAST=1): turnos y animaciones más cortos.
const FAST = process.env.GW_FAST === '1';
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
// Anti-estancamiento: si nadie muere en N disparos se renueva el mapa; y hay un tope duro de disparos
export const STALL_SHOTS = FAST ? 4 : 8;
export const MAX_SHOTS = FAST ? 40 : 90;
export const TEAMS = { LEFT: 'left', RIGHT: 'right' };
export const MODES = { FUNCTION: 'function', ODE1: 'ode1', ODE2: 'ode2' };
export const MODE_LABELS = { function: 'y =', ode1: "y' =", ode2: "y'' =" };
