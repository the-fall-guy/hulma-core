/** The axis the mold presses along: Z for front-back, X for left-right and Y for top-bottom. */
export type TMoldDirection = 'front-back' | 'left-right' | 'top-bottom';

export interface IMoldingSettings {
    direction: TMoldDirection;
    /** Impression resolution: the pixels on the longest side of the image. */
    fineness: number;
    /** The largest gap allowed before a point is added, as a fraction of the model's largest dimension. */
    detail: number;
    /** The most unique points the cast may use. */
    pointBudget: number;
    /** Sigma of the Gaussian that smooths the depths, in pixels. */
    softness: number;
    /** The smallest piece or hole kept, as a fraction of the outline area. */
    crumbs: number;
    /** Tolerance for simplifying the parting line, in pixels. */
    partingLineDetail: number;
    /** The long side of the paint atlas, in pixels. */
    textureSize: number;
}
