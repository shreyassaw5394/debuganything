const no = async () => { throw new Error("fs is not available in the browser"); };
export const readFile = no, writeFile = no, stat = no, mkdir = no, readdir = no, rm = no, access = no, appendFile = no, readlink = no, symlink = no, unlink = no, copyFile = no, rename = no, chmod = no, lstat = no, realpath = no;
export default { readFile: no, writeFile: no, stat: no, mkdir: no, readdir: no, rm: no };
