package com.agentic.assistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log

class AgenticAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AgenticAccessibilityService"
        var instance: AgenticAccessibilityService? = null
            private set

        fun isSharedServiceConnected(): Boolean {
            return instance != null
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "Accessibility Service Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Can be used to track active window package names or text changes
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility Service Interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
        Log.d(TAG, "Accessibility Service Destroyed")
    }

    // --- Action Methods Executable from React Native via Companion Instance ---

    fun clickText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text)
        if (nodes.isNullOrEmpty()) {
            root.recycle()
            return false
        }
        var clicked = false
        for (node in nodes) {
            if (node.isClickable) {
                clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (clicked) {
                    node.recycle()
                    break
                }
            } else {
                var parent = node.parent
                while (parent != null) {
                    if (parent.isClickable) {
                        clicked = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        if (clicked) {
                            parent.recycle()
                            break
                        }
                    }
                    val temp = parent.parent
                    parent.recycle()
                    parent = temp
                }
                if (clicked) {
                    node.recycle()
                    break
                }
            }
            node.recycle()
        }
        root.recycle()
        return clicked
    }

    fun clickId(id: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = root.findAccessibilityNodeInfosByViewId(id)
        if (nodes.isNullOrEmpty()) {
            root.recycle()
            return false
        }
        var clicked = false
        for (node in nodes) {
            if (node.isClickable) {
                clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (clicked) {
                    node.recycle()
                    break
                }
            } else {
                var parent = node.parent
                while (parent != null) {
                    if (parent.isClickable) {
                        clicked = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        if (clicked) {
                            parent.recycle()
                            break
                        }
                    }
                    val temp = parent.parent
                    parent.recycle()
                    parent = temp
                }
                if (clicked) {
                    node.recycle()
                    break
                }
            }
            node.recycle()
        }
        root.recycle()
        return clicked
    }

    fun typeText(id: String?, text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val targetNode = if (!id.isNullOrEmpty()) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id)
            val node = nodes?.firstOrNull { it.isEditable || it.isFocused } ?: nodes?.firstOrNull()
            nodes?.forEach { if (it != node) it.recycle() }
            node
        } else {
            findFocusedEditableNode(root)
        }

        if (targetNode == null) {
            root.recycle()
            return false
        }

        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        val success = targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        targetNode.recycle()
        root.recycle()
        return success
    }

    private fun findFocusedEditableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable && (node.isFocused || node.isAccessibilityFocused)) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findFocusedEditableNode(child)
            if (found != null) {
                // Keep the found node, recycle child if not the found one (done inside recursive traversal)
                return found
            }
            child.recycle()
        }
        return null
    }

    fun scroll(direction: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val scrollableNodes = findScrollableNode(root)
        if (scrollableNodes == null) {
            root.recycle()
            return false
        }
        val action = if (direction.equals("UP", ignoreCase = true)) {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }
        val success = scrollableNodes.performAction(action)
        scrollableNodes.recycle()
        root.recycle()
        return success
    }

    private fun findScrollableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isScrollable) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findScrollableNode(child)
            if (found != null) {
                return found
            }
            child.recycle()
        }
        return null
    }

    fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, duration: Int): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val path = Path().apply {
                moveTo(x1.toFloat(), y1.toFloat())
                lineTo(x2.toFloat(), y2.toFloat())
            }
            val stroke = GestureDescription.StrokeDescription(path, 0, duration.toLong())
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            
            var success = false
            val lock = Object()
            
            dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    super.onCompleted(gestureDescription)
                    synchronized(lock) {
                        success = true
                        lock.notify()
                    }
                }
                override fun onCancelled(gestureDescription: GestureDescription?) {
                    super.onCancelled(gestureDescription)
                    synchronized(lock) {
                        success = false
                        lock.notify()
                    }
                }
            }, null)

            synchronized(lock) {
                try {
                    lock.wait(duration.toLong() + 200)
                } catch (e: InterruptedException) {
                    return false
                }
            }
            return success
        }
        return false
    }

    fun readWindowText(): String {
        val root = rootInActiveWindow ?: return ""
        val sb = StringBuilder()
        collectText(root, sb)
        root.recycle()
        return sb.toString()
    }

    private fun collectText(node: AccessibilityNodeInfo, sb: StringBuilder) {
        val text = node.text
        if (!text.isNullOrEmpty()) {
            sb.append(text).append("\n")
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectText(child, sb)
            child.recycle()
        }
    }
}
