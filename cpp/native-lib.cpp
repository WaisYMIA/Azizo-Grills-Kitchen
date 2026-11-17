// Starts Node.js (nodejs-mobile, Node 18) inside the app process. Adapted from the nodejs-mobile project (MIT licence).
#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include "node.h"

static const char *ADBTAG = "AZIZO-NODE";
static int pipe_stdout[2];
static int pipe_stderr[2];

static void *pump(void *arg) {
  int fd = *(int *)arg; int prio = (fd == pipe_stderr[0]) ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
  char buf[2048]; ssize_t n;
  while ((n = read(fd, buf, sizeof buf - 1)) > 0) { if (buf[n - 1] == '\n') --n; buf[n] = 0; __android_log_write(prio, ADBTAG, buf); }
  return 0;
}
static int start_redirecting() {
  setvbuf(stdout, 0, _IONBF, 0); if (pipe(pipe_stdout) != 0) return -1; dup2(pipe_stdout[1], STDOUT_FILENO);
  setvbuf(stderr, 0, _IONBF, 0); if (pipe(pipe_stderr) != 0) return -1; dup2(pipe_stderr[1], STDERR_FILENO);
  pthread_t t1, t2;
  if (pthread_create(&t1, 0, pump, &pipe_stdout[0]) != 0) return -1; pthread_detach(t1);
  if (pthread_create(&t2, 0, pump, &pipe_stderr[0]) != 0) return -1; pthread_detach(t2);
  return 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_azizo_app_NodeRuntime_startNodeWithArguments(JNIEnv *env, jobject /* this */, jobjectArray arguments, jboolean redirectOutputToLogcat) {
  jsize argc = env->GetArrayLength(arguments);
  // libuv needs all arguments in one contiguous block of memory
  size_t total = 0;
  for (jsize i = 0; i < argc; i++) {
    jstring s = (jstring)env->GetObjectArrayElement(arguments, i);
    const char *c = env->GetStringUTFChars(s, 0); total += strlen(c) + 1; env->ReleaseStringUTFChars(s, c); env->DeleteLocalRef(s);
  }
  char *buffer = (char *)calloc(total, 1);
  char **argv = (char **)calloc(argc + 1, sizeof(char *));
  char *pos = buffer;
  for (jsize i = 0; i < argc; i++) {
    jstring s = (jstring)env->GetObjectArrayElement(arguments, i);
    const char *c = env->GetStringUTFChars(s, 0);
    strncpy(pos, c, strlen(c)); argv[i] = pos; pos += strlen(c) + 1;
    env->ReleaseStringUTFChars(s, c); env->DeleteLocalRef(s);
  }
  if (redirectOutputToLogcat && start_redirecting() == -1) __android_log_write(ANDROID_LOG_ERROR, ADBTAG, "could not redirect stdout/stderr to logcat");
  return jint(node::Start((int)argc, argv));
}
