// pty_bridge: fakes a serial port inside an Android emulator with a pty and
// relays its bytes to a TCP port that the host reaches through `adb forward`.
// Usage (root): pty_bridge <serial path, e.g. /dev/ttySMT6> <tcp port>
// Built by build.sh into resources/pty-bridge/<abi>/pty_bridge.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>

static int open_pty(const char *link_path) {
    int master = posix_openpt(O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (master < 0 || grantpt(master) != 0 || unlockpt(master) != 0) {
        perror("posix_openpt");
        exit(1);
    }
    const char *slave = ptsname(master);
    if (!slave) {
        perror("ptsname");
        exit(1);
    }
    chmod(slave, 0666);

    // Holding the slave open keeps the master from reporting POLLHUP (and
    // poll() from spinning) while the app has the port closed.
    int keep = open(slave, O_RDWR | O_NOCTTY);
    if (keep < 0) {
        perror("open slave");
        exit(1);
    }
    struct termios tio;
    if (tcgetattr(keep, &tio) == 0) {
        cfmakeraw(&tio);
        tcsetattr(keep, TCSANOW, &tio);
    }

    unlink(link_path);
    if (symlink(slave, link_path) != 0) {
        perror("symlink");
        exit(1);
    }
    printf("pty_bridge: %s -> %s\n", link_path, slave);
    fflush(stdout);
    return master;
}

static int listen_tcp(int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    int on = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(port);
    if (bind(fd, (struct sockaddr *) &addr, sizeof(addr)) != 0 || listen(fd, 1) != 0) {
        perror("listen");
        exit(1);
    }
    printf("pty_bridge: listening 127.0.0.1:%d\n", port);
    fflush(stdout);
    return fd;
}

// Serial devices drop bytes nobody reads; do the same instead of blocking.
static void write_drop(int fd, const char *buf, ssize_t len) {
    while (len > 0) {
        ssize_t w = write(fd, buf, len);
        if (w < 0) {
            if (errno == EINTR) continue;
            return;
        }
        buf += w;
        len -= w;
    }
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s <serial-path> <tcp-port>\n", argv[0]);
        return 2;
    }
    int port = atoi(argv[2]);
    if (port <= 0 || port > 65535) {
        fprintf(stderr, "bad port: %s\n", argv[2]);
        return 2;
    }
    signal(SIGPIPE, SIG_IGN);
    int master = open_pty(argv[1]);
    int server = listen_tcp(port);
    int client = -1;
    char buf[4096];

    for (;;) {
        struct pollfd fds[3];
        int n = 0;
        fds[n].fd = master; fds[n].events = POLLIN; n++;
        fds[n].fd = server; fds[n].events = POLLIN; n++;
        if (client >= 0) { fds[n].fd = client; fds[n].events = POLLIN; n++; }

        if (poll(fds, n, -1) < 0) {
            if (errno == EINTR) continue;
            perror("poll");
            return 1;
        }

        if (fds[0].revents & POLLIN) {
            ssize_t r = read(master, buf, sizeof(buf));
            if (r > 0 && client >= 0 && write(client, buf, r) < 0) {
                close(client);
                client = -1;
            }
        }
        if (fds[1].revents & POLLIN) {
            int c = accept(server, NULL, NULL);
            if (c >= 0) {
                int on = 1;
                setsockopt(c, IPPROTO_TCP, TCP_NODELAY, &on, sizeof(on));
                if (client >= 0) close(client);
                client = c;
                printf("pty_bridge: client connected\n");
                fflush(stdout);
            }
        }
        if (n == 3 && (fds[2].revents & (POLLIN | POLLHUP | POLLERR))) {
            ssize_t r = read(client, buf, sizeof(buf));
            if (r <= 0) {
                close(client);
                client = -1;
                printf("pty_bridge: client disconnected\n");
                fflush(stdout);
            } else {
                write_drop(master, buf, r);
            }
        }
    }
}
