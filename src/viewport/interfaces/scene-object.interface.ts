import {IMeshStats} from '@core/common/interfaces/mesh-stats.interface';
import {IVector3} from '@core/math/interfaces/vector.interface';
import {ITextureInfo} from '@core/viewport/interfaces/texture-info.interface';

export interface ISceneObject {
    id: string;
    name: string;
    fileName: string;
    dimensions: IVector3;
    stats: IMeshStats;
    textures: ITextureInfo[];
}
