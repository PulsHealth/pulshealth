/** Export only the currently rendered artwork. No network or persistence. */
export function saveText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportImage(
  svg: SVGSVGElement,
  filename: string,
  share = false,
) {
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(
    new Blob([source], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render the image."));
      image.src = url;
    });
    const box = svg.viewBox.baseVal;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = Math.round((box.height / box.width) * 1080);
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image export is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not create the image.")),
        "image/png",
      ),
    );
    const file = new File([blob], `${filename}.png`, { type: "image/png" });
    if (share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return "Shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return "";
      }
    }
    const download = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = download;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(download), 1000);
    return "Image download started";
  } finally {
    URL.revokeObjectURL(url);
  }
}
