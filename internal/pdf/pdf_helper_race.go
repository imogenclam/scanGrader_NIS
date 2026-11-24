//go:build linux && race

package pdf

// детектору гонок нужны терабайты адресов, с RLIMIT_AS он падает сам; память держит сторож
const helperLimitAddrSpace = false
