import type {ArcRotateInteraction} from '@babylonjs/core/Cameras/arcRotateCameraMovement';
import type {InputMapEntry} from '@babylonjs/core/Cameras/inputMapper';
import {ICameraAngles} from '@core/viewport/interfaces/camera-angles.interface';

export const VIEWPORT_BACKGROUND_COLOR = '#3D3D3D';
export const GRID_LINE_COLOR = '#545454';
export const GRID_LINE_OPACITY = 0.5;
export const AXIS_X_COLOR = '#FF3352';
export const AXIS_Z_COLOR = '#8BDC00';
export const CLAY_COLOR = '#BDBDBD';
export const SELECTION_OUTLINE_COLOR = '#F0A23B';
export const WIREFRAME_COLOR = '#1A1A1A';
export const WIREFRAME_ALPHA = 0.35;

export const GRID_SIZE = 200;

export const BLENDER_NAVIGATION_INPUT_MAP: InputMapEntry<ArcRotateInteraction>[] = [
    {source: 'pointer', button: 1, modifiers: {shift: true}, interaction: 'pan'},
    {source: 'pointer', button: 1, interaction: 'rotate'},
    {source: 'pointer', button: 0, interaction: 'rotate'},
    {source: 'wheel', interaction: 'zoom'},
];

// Camera angles for the numpad views, keyed by key code, with Ctrl for the opposite side. The camera sits at
// (cos(alpha) sin(beta), cos(beta), sin(alpha) sin(beta)) from its target: front is +Z, right is +X, top is +Y.
// Top and bottom stop just short of the poles, where looking along the up axis would collapse the view matrix.
// Babylon's default beta limits (0.01 and PI - 0.01) still clamp them to 0.01 on the first rendered frame.
export const NUMPAD_VIEWS: Record<string, ICameraAngles> = {
    Numpad1: {alpha: Math.PI / 2, beta: Math.PI / 2},
    'Ctrl+Numpad1': {alpha: -Math.PI / 2, beta: Math.PI / 2},
    Numpad3: {alpha: 0, beta: Math.PI / 2},
    'Ctrl+Numpad3': {alpha: Math.PI, beta: Math.PI / 2},
    Numpad7: {alpha: Math.PI / 2, beta: 0.0001},
    'Ctrl+Numpad7': {alpha: Math.PI / 2, beta: Math.PI - 0.0001},
};

// Elements that take typing, so viewport shortcuts leave their keys alone.
export const EDITABLE_TAG_NAMES = ['INPUT', 'TEXTAREA', 'SELECT'];
