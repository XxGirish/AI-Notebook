import { useEffect, useState } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { loadAsset } from "../persistence/notebookDatabase";

type Props = {
  assetHash: string;
  name: string;
  width: number;
  height: number;
};

export function CanvasImage({ assetHash, name, width, height }: Props) {
  const [image, setImage] = useState<HTMLImageElement>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadAsset(assetHash).then((asset) => {
      if (cancelled) return;
      if (!asset) {
        setFailed(true);
        return;
      }
      objectUrl = URL.createObjectURL(asset.blob);
      const nextImage = new Image();
      nextImage.onload = () => {
        if (!cancelled) setImage(nextImage);
      };
      nextImage.onerror = () => {
        if (!cancelled) setFailed(true);
      };
      nextImage.src = objectUrl;
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetHash]);

  if (image) return <KonvaImage image={image} width={width} height={height} />;

  return (
    <Group listening={false}>
      <Rect width={width} height={height} fill="#ece9e1" />
      <Text
        width={width}
        height={height}
        padding={12}
        text={failed ? `Missing image: ${name}` : `Loading ${name}…`}
        align="center"
        verticalAlign="middle"
        fill="#657376"
        fontSize={14}
      />
    </Group>
  );
}
