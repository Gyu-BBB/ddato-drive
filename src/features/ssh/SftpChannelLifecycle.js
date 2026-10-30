// ssh2 1.17's SFTP channel lacks the public exit() available on exec channels.
// OpenSSH scp requires an exit status before channel close to report success.
export function finishSftpChannel(stream) {
  try {
    if (stream.server && stream.outgoing.state === 'open') stream._protocol.exitStatus(stream.outgoing.id, 0);
  } finally { stream.end(); }
}
