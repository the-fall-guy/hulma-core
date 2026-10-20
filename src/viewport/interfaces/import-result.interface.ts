import {ISceneObject} from '@core/viewport/interfaces/scene-object.interface';

export type TImportFailureReason = 'unsupported-format' | 'unreadable';

export interface IImportFailure {
    fileName: string;
    reason: TImportFailureReason;
}

export interface IImportResult {
    sceneObjects: ISceneObject[];
    failures: IImportFailure[];
}
