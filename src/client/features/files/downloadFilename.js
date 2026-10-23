export function downloadPickerOptions(name) {
  const options = { suggestedName: name };
  const compound = name.match(/\.tar\.(?:gz|bz2|xz|zst|lz|lzma)$/i);
  const extension = compound?.[0] || name.match(/\.[a-z0-9]{1,15}$/i)?.[0];
  if (!extension) return options;

  // A suggested name alone does not preserve the suffix when the user renames it.
  return {
    ...options,
    excludeAcceptAllOption: true,
    types: [{ description: `${extension} 파일`, accept: { 'application/octet-stream': [extension] } }]
  };
}
