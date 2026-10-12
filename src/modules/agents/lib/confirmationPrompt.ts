const ACTION_RE =
  /继续|开始|执行|实施|修改|修复|提交|推送|发送|发给|发出去|安装|部署|发布|删除|采用|按.+(?:办|做)|确认|同意|批准/;

export function asksConfirm(text: string): boolean {
  const lines = text.trim().split("\n");
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine || /^(?:>|```|~~~)/.test(lastLine)) return false;
  const line = lastLine.replace(/\*\*|__/g, "");
  const sentence = line.match(/[^。！？!?]+[。！？!?]?$/)?.[0]?.trim() ?? "";
  if (!sentence || /还是|哪个|哪种|哪一个/.test(sentence)) return false;

  if (/^(?:请|麻烦)(?:你)?(?:先|再|帮忙)?(?:确认|批准|同意)/.test(sentence))
    return true;
  if (/(?:可以|同意|确认|批准|允许|行|好)(?:吗|么)[？?。.]?$/.test(sentence))
    return true;
  if (
    /^(?:请问[，,：: ]*)?(?:你)?(?:是否|要不要|需不需要)/.test(sentence) &&
    ACTION_RE.test(sentence)
  )
    return true;
  return (
    /(?:需要我|要我|我可以|我能)/.test(sentence) &&
    ACTION_RE.test(sentence) &&
    /(?:吗|么)[？?。.]?$/.test(sentence)
  );
}
